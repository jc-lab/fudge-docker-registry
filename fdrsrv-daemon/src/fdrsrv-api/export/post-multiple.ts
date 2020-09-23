import * as express from 'express';
import * as bunyan from 'bunyan';
import * as crypto from 'crypto';
import * as uuid from 'uuid';
import * as util from 'util';
import * as fs from 'fs';
import * as tarStream from 'tar-stream';

import * as manifestStore from '../../store/manifest-store';
import * as blobStore from '../../store/blob-store';

import {
  IManifestAllVersions
} from '../../types';
import {
  IExportedManifest
} from '../types';

const logger = bunyan.createLogger({
  name: 'export-multiple-image',
  level: 'info'
});

interface IRequestBody {
  imageList: string[];
}

interface IBlobItem {
  registry: string;
  name: string;
  digest: string;
}

const IMAGE_NAME_REGEX = /^([^/]+)\/(.+):([^:]+)$/;

class WorkingContext {
  blobList: Map<string, IBlobItem> = new Map();

  manifestList: Map<string, IExportedManifest> = new Map();

  processManifest(param: manifestStore.IGetManifestParams, temp: manifestStore.IGetManifestResult): Promise<void> {
    const manifest: IManifestAllVersions = JSON.parse(temp.data);
    const fullname = `${param.registry}/${param.name}`;
    const hashedName = crypto
      .createHash('sha256')
      .update(fullname)
      .update(':')
      .update(param.reference)
      .digest()
      .toString('hex');
    this.manifestList.set(hashedName, {
      name: fullname,
      tag: param.reference,
      media_type: temp.mediaType,
      scheme_version: manifest.schemaVersion,
      data: Buffer.from(temp.data).toString('base64')
    });
    if (temp.mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json') {
      if (manifest.schemaVersion === 2 && manifest.manifests) {
        return manifest.manifests.reduce((prev, cur) => prev
          .then(() => this.fetchManifest({
            registry: param.registry,
            name: param.name,
            reference: cur.digest
          })), Promise.resolve());
      }
    } else if (manifest.schemaVersion === 1) {
      if (manifest.fsLayers) {
        manifest.fsLayers.forEach((v) => this.blobList.set(v.blobSum, {
          registry: param.registry,
          name: param.name,
          digest: v.blobSum
        }));
      }
    } else if (manifest.schemaVersion === 2) {
      if (manifest.config) {
        this.blobList.set(manifest.config.digest, {
          registry: param.registry,
          name: param.name,
          digest: manifest.config.digest
        });
      }
      if (manifest.layers) {
        manifest.layers.forEach((v) => this.blobList.set(v.digest, {
          registry: param.registry,
          name: param.name,
          digest: v.digest
        }));
      }
    }
    return Promise.resolve();
  }

  fetchManifest(param: manifestStore.IGetManifestParams): Promise<void> {
    return manifestStore.getManifest({
      registry: param.registry,
      name: param.name,
      reference: param.reference
    })
      .then((temp) => this.processManifest(param, temp));
  }
}

export default (req: express.Request, res: express.Response, next: any) => {
  const reqid = uuid.v4();
  const body = req.body as IRequestBody;
  const ctx = new WorkingContext();

  logger.info({
    reqid
  }, 'Start exporting');

  body.imageList
    .map((name) => [name, IMAGE_NAME_REGEX.exec(name)])
    .reduce((prev, [fullname, parsedName]) => prev.then(() => {
      if (parsedName) {
        const registry = parsedName[1];
        const imageName = parsedName[2];
        const imageTag = parsedName[3];
        return ctx.fetchManifest({
          registry,
          name: imageName,
          reference: imageTag
        });
      }
      return Promise.reject(new Error(`Unknown image name: ${fullname}`));
    }), Promise.resolve())
    .then(() => {
      const tarPacker = tarStream.pack();

      res
        .status(200)
        .contentType('application/tar');

      tarPacker.pipe(res);
      return util.promisify(tarPacker.entry.bind(tarPacker))({
        name: 'manifests',
        type: 'directory'
      })
        .then(() => {
          const manifestKeys = [...ctx.manifestList.keys()];
          return manifestKeys.reduce((prev, cur) => prev.then(() => new Promise((resolve, reject) => {
            const metadata = ctx.manifestList.get(cur);
            const payload = Buffer.from(JSON.stringify(metadata, null, 1));
            const entry = tarPacker.entry({
              name: `manifests/${cur}.json`,
              size: payload.byteLength
            }, (err) => {
              if (err) reject(err);
              else resolve();
            });
            entry.write(payload);
            entry.end();
          })), Promise.resolve());
        })
        .then(() => {
          const blobs = [...ctx.blobList.values()];
          return blobs.reduce((prev, cur) => prev.then(() => blobStore.getBlob({
            registry: cur.registry,
            name: cur.name,
            digest: cur.digest
          })
            .then((blobResult) => new Promise((resolve, reject) => {
              const entry = tarPacker.entry({
                name: `blobs/${cur.digest}`,
                size: blobResult.stats.size
              }, (err) => {
                if (err) reject(err);
                else resolve();
              });
              const fis = fs.createReadStream(blobResult.file);
              fis
                .on('error', (err) => reject(err))
                .pipe(entry);
            }))), Promise.resolve());
        })
        .then(() => {
          tarPacker.finalize();
        });
    })
    .catch((err) => next(err));
};
