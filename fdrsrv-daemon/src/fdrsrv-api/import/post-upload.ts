import * as express from 'express';
import * as uuid from 'uuid';
import * as streams from 'stream';
import * as tarStream from 'tar-stream';
import * as bunyan from 'bunyan';
import * as crypto from 'crypto';

import {
  IExportedManifest
} from '../types';

import * as manifestStore from '../../store/manifest-store';
import * as blobStore from '../../store/blob-store';

const BLOB_NAME_REGEX = /\/([^:]+:[0-9a-fA-F]+)$/;

enum ResponseState {
  IDLE,
  RESOLVED,
  REJECTED
}

const logger = bunyan.createLogger({
  name: 'import-image-push',
  level: 'debug'
});

export default (req: express.Request, res: express.Response, expressNext: any) => {
  const uploadId = uuid.v4();
  const tarExtract = tarStream.extract();
  const manifests: IExportedManifest[] = [];

  let state: ResponseState = ResponseState.IDLE;
  const blobContexts: blobStore.PutBlobContext[] = [];

  const rejectRequest = (err) => {
    if (state === ResponseState.IDLE) {
      logger.error({
        uploadId,
        err
      }, 'Impport failed');
      expressNext(err);
      state = ResponseState.REJECTED;
    }
  };

  const resolveRequest = () => {
    res
      .sendStatus(204);
  };

  logger.info({
    uploadId
  }, 'Start import');

  req
    .pipe(tarExtract)
    .on('entry', (headers: tarStream.Headers, stream: streams.PassThrough, next: () => void) => {
      if (state !== ResponseState.IDLE) {
        next();
        return;
      }
      logger.debug({
        uploadId
      }, `tar stream entry: ${headers.name}`);
      if (headers.name.startsWith('manifests/')) {
        const chunks: Buffer[] = [];
        stream
          .on('data', (chunk) => {
            chunks.push(chunk);
          })
          .on('finish', () => {
            const payload = Buffer.concat(chunks).toString('utf8');
            manifests.push(JSON.parse(payload));
            next();
          });
      } else if (headers.name.startsWith('blobs/')) {
        const parsedBlobName = BLOB_NAME_REGEX.exec(headers.name);
        blobStore.preparePutBlob(uploadId, '', parsedBlobName[1])
          .then((blobCtx) => new Promise((resolve, reject) => {
            const fos = blobCtx.createWriteStream();
            stream.pipe(fos)
              .on('error', (err) => {
                reject(err);
              })
              .on('finish', () => {
                resolve();
              });
          })
            .then(() => blobContexts.push(blobCtx)))
          .catch((err) => {
            rejectRequest(err);
          })
          .finally(() => {
            next();
          });
      } else {
        next();
      }
    })
    .on('finish', () => {
      if (state !== ResponseState.IDLE) {
        return;
      }
      blobContexts
        .reduce((prev, cur) => prev.then(() => cur.commit()), Promise.resolve())
        .then(() => manifests.reduce((prev, cur) => prev
          .then(() => {
            const data = Buffer.from(cur.data, 'base64');
            const digest = `sha256:${crypto.createHash('sha256').update(data).digest().toString('hex')}`;
            return manifestStore.putManifest(cur.name, cur.tag, data.toString('utf8'))
              .then(() => manifestStore.putManifest(cur.name, digest, data.toString('utf8')));
          }), Promise.resolve()))
        .then(() => {
          resolveRequest();
        })
        .catch((err) => rejectRequest(err));
    })
    .on('error', (err) => {
      tarExtract.destroy(err);
      rejectRequest(err);
    });
};
