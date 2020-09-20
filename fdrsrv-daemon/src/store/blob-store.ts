import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';
import * as mkdirp from 'mkdirp';
import * as uuid from 'uuid';

import * as errors from '@src/constants/errors';
import CustomError from '@src/http-errors/custom-error';
import proxyService from '@src/services/proxy-service';
import appEnv from '../app-env';

export interface IGetBlobParams {
  registry?: string;
  name: string;
  digest: string;
}

export interface IGetBlobResult {
  file: string;
  stats: fs.Stats;
  contentType: string;
}

export class PutBlobContext {
  private _uploadId: string;

  private _name: string;

  private _digest: string;

  private _path: string;

  private _tempFile: string;

  private _digestAlgorithm: string;

  private _digestValue: string;

  private _computedDigest: string;

  constructor(uploadId: string, name: string, digest: string) {
    this._uploadId = uploadId;
    this._name = name;
    this._digest = digest;

    [this._digestAlgorithm, this._digestValue] = digest.split(':', 2);

    this._path = path.resolve(appEnv.getBlobsDir(), this._digestAlgorithm, this._digestValue);
    this._tempFile = `${this._path}.tmp.${uuid.v4().replace(/-/g, '').substring(0, 8)}`;
  }

  prepare(): Promise<this> {
    return mkdirp(path.dirname(this._path))
      .then(() => this);
  }

  simpleWrite(data: Buffer | string): Promise<this> {
    const self = this;
    return new Promise<this>((resolve, reject) => {
      fs.writeFile(this._tempFile, data, (err) => {
        if (err) reject(err);
        else resolve(self);
      });
    });
  }

  createWriteStream() {
    return fs.createWriteStream(this._tempFile);
  }

  commit(): Promise<void> {
    return util.promisify(fs.rename)(this._tempFile, this._path);
  }

  getDigestAlgorithm(): string {
    return this._digestAlgorithm;
  }

  getDigest(): string {
    return `${this._digestAlgorithm}:${this._computedDigest}`;
  }

  validate(): boolean {
    return this._computedDigest.toLowerCase() === this._digestValue.toLowerCase();
  }
}

export function getBlob(params: IGetBlobParams): Promise<IGetBlobResult> {
  return new Promise<IGetBlobResult>(async (resolve, reject) => {
    const tokens = params.digest.split(':', 2);
    const file = path.join(appEnv.getBlobsDir(), tokens[0], tokens[1]);
    let stats: fs.Stats;
    try {
      stats = await util.promisify(fs.stat)(file);
    } catch (e) {
      if (e.code === 'ENOENT') {
        if (appEnv.APP_PROXY_MODE) {
          proxyService.getBlob({
            ...params,
            file
          })
            .then(() => util.promisify(fs.stat)(file))
            .then((newStats) => {
              resolve({
                file,
                stats: newStats,
                contentType: 'application/octet-stream'
              });
            })
            .catch((err) => {
              reject(err);
            });
          return;
        }

        reject(new CustomError(errors.DIGEST_INVALID));
        return;
      }
      reject(e);
      return;
    }

    resolve({
      file,
      stats,
      contentType: 'application/octet-stream'
    });
  });
}

export function preparePutBlob(
  uploadId: string, name: string, digest: string
): Promise<PutBlobContext> {
  try {
    const ctx = new PutBlobContext(uploadId, name, digest);
    return ctx.prepare()
      .then(() => ctx);
  } catch (e) {
    return Promise.reject(e);
  }
}
