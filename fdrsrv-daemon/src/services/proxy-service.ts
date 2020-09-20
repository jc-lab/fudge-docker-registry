import * as bunyan from 'bunyan';
import * as drc from '@jc-lab/docker-registry-client';
// eslint-disable-next-line
import * as restify from 'restify';
import * as http from 'http';

import appEnv from '@src/app-env';

import CustomError from '@src/http-errors/custom-error';
import * as errors from '@src/constants/errors';
import HttpError from '@src/http-errors/base';
import * as store from '@src/store';

import computeDigest from '@src/utils/digest';

interface IManifestSchemaVersion2 {
  schemaVersion: number;
  mediaType: string;
  config: {
    mediaType: string;
    size: number;
    digest: string;
  };
  layers?: [{
    mediaType: string;
    size: number;
    digest: string;
  }];
  manifests?: [{
    digest: string,
    mediaType: string;
    platform: {
      architecture: string;
      os: string;
    },
    size: string;
  }];
}

export interface IGetManifestResult {
  mediaType: string;
  manifest: string;
}

export interface IGetManifestParams {
  registry?: string;
  name: string;
  reference: string;
}

export interface IGetBlobParams {
  registry?: string;
  name: string;
  digest: string;
  file: string;
}

interface FutureCallback<T> {
  resolve: (res: T) => void;
  reject: (err: any) => void;
}

interface IManifestItem {
  tag: string;
  schemaVersion: number,
  mediaType: string;
  data: any;
  raw: string;
}

interface IBaseImageParams {
  registry?: string;
  name: string;
  [key: string]: any;
}

function toHttpError(err: any) {
  return HttpError.isInstance(err) ? err : new HttpError({
    status: 404,
    message: err.message
  });
}

function concatName(params: IBaseImageParams) {
  return `${params.registry}/${params.name}`;
}

/**
 * promisify with multiple callback arguments to array
 */
function promisifyMa(func: (...params: any[]) => void): (...args: any[]) => Promise<any[]> {
  return (...args: any[]) => new Promise<any[]>((resolve, reject) => {
    func(...args, (err, ...responses) => {
      if (err) reject(err);
      else resolve(responses);
    });
  });
}

const drcLog = bunyan.createLogger({
  name: 'drc',
  level: appEnv.APP_DRC_LOG_LEVEL as any
});

class ImageTagContext {
  readonly parent: DownloadingImageInfo;

  readonly reference: string;

  public referenceList: string[];

  public waitingList: FutureCallback<IGetManifestResult>[] = [];

  /**
   * 0: Fetching
   * 1: Resolved
   * 2: Rejected
   */
  public manifestState: number = 0;

  public manifestFetchError: any;

  public manifestSchemaVersion: number = 0;

  public manifestMediaType: string = undefined;

  public manifestString: string = undefined;

  public manifestData: any = undefined;

  public manifestList: IManifestItem[] = [];

  constructor(parent: DownloadingImageInfo, reference: string) {
    this.parent = parent;
    this.reference = reference;
    this.referenceList = [
      reference
    ];
  }

  resolve() {
    this.manifestState = 1;
    let item: FutureCallback<IGetManifestResult>;
    while ((item = this.waitingList.shift())) {
      item.resolve({
        mediaType: this.manifestMediaType,
        manifest: this.manifestString
      });
    }
  }

  reject(err: any) {
    const httpError = toHttpError(err);
    this.manifestState = 2;
    this.manifestFetchError = err;
    let item: FutureCallback<IGetManifestResult>;
    while ((item = this.waitingList.shift())) {
      item.reject(httpError);
    }
  }

  finish() {
    this.referenceList.forEach((reference) => {
      delete this.parent.tagContext[reference];
    });
  }

  downloadRootManifest(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const { repoClient } = this.parent;
      repoClient.getManifest({
        ref: this.reference,
        acceptManifestLists: true,
        maxSchemaVersion: 2
      }, (err, manifest: any, res: restify.Response, manifestStr: string) => {
        if (err) {
          reject(err);
          return;
        }

        const mediaType = manifest.mediaType || res.headers['content-type'];
        const digest = computeDigest(manifestStr);

        this.referenceList.push(digest);
        if (!this.parent.tagContext[digest]) {
          this.parent.tagContext[digest] = this;
        }

        this.manifestSchemaVersion = manifest.schemaVersion;
        this.manifestMediaType = mediaType;
        this.manifestString = manifestStr;
        this.manifestData = manifest;

        this.manifestList.push({
          tag: this.reference,
          schemaVersion: manifest.schemaVersion,
          mediaType,
          raw: manifestStr,
          data: manifest
        });
        this.manifestList.push({
          tag: digest,
          schemaVersion: manifest.schemaVersion,
          mediaType,
          raw: manifestStr,
          data: manifest
        });

        resolve();
      });
    });
  }

  downloadSubManifests(): Promise<any> {
    if (this.manifestSchemaVersion === 1) {
      return Promise.resolve();
    } if (this.manifestSchemaVersion === 2) {
      return this.downloadSubManifestsSchema2(this.manifestData);
    }
    return Promise.reject(new Error(`Not supported schema version = ${this.manifestSchemaVersion}`));
  }

  commitManifests(): Promise<any> {
    return store.dbIsolateRun<any>((db) => {
      const list: Promise<void>[] = [];
      const uploadedAt = new Date();
      this.manifestList.forEach((item) => {
        list.push(new Promise<void>((resolve, reject) => {
          db.run(
            'INSERT INTO `manifest` (`name`, `tag`, `schema_version`, `uploaded_at`, `media_type`, `manifest`) VALUES (?, ?, ?, ?, ?, ?)',
            [
              this.parent.localImageName,
              item.tag,
              item.schemaVersion,
              uploadedAt.getTime(),
              item.mediaType,
              item.raw
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        }));
      });
      return Promise.all(list);
    });
  }

  downloadSubManifestsSchema2(manifest: IManifestSchemaVersion2): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const { repoClient } = this.parent;
      if (manifest.mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json') {
        const promiseList: Promise<any>[] = [];
        manifest.manifests.forEach((item) => {
          promiseList.push(
            promisifyMa(repoClient.getManifest.bind(repoClient))({
              ref: item.digest,
              maxSchemaVersion: 2
            })
              .then((responses) => {
                const data: any = responses[0];
                const res: restify.Response = responses[1];
                const raw: string = responses[2];
                this.manifestList.push({
                  tag: item.digest,
                  schemaVersion: data.schemaVersion,
                  mediaType: data.mediaType || res.headers['content-type'],
                  data,
                  raw
                });
              })
          );
        });
        Promise.all(promiseList)
          .then(() => {
            resolve();
          })
          .catch((err) => {
            reject(err);
          });
      } else if (manifest.mediaType === 'application/vnd.docker.distribution.manifest.v2+json') {
        resolve();
      } else {
        reject(new Error('Unknown mediaType'));
      }
    });
  }
}

class ImageBlobContext {
  readonly parent: DownloadingImageInfo;

  readonly digest: string;

  public waitingList: FutureCallback<void>[] = [];

  constructor(parent: DownloadingImageInfo, digest: string) {
    this.parent = parent;
    this.digest = digest;
  }

  resolve() {
    this.waitingList.forEach((item) => {
      item.resolve();
    });
    delete this.parent.blobContext[this.digest];
  }

  reject(err: any) {
    const httpError = toHttpError(err);
    this.waitingList.forEach((item) => {
      item.reject(httpError);
    });
    delete this.parent.blobContext[this.digest];
  }
}

export class DownloadingImageInfo {
  public readonly key: string;

  public readonly registry: string;

  public readonly imageName: string;

  public readonly localImageName: string;

  public repoClient: drc.RegistryClientV2;

  public tagContext: Record<string, ImageTagContext> = {};

  public blobContext: Record<string, ImageBlobContext> = {};

  constructor(params: IBaseImageParams) {
    this.registry = params.registry;
    this.imageName = params.name;
    this.localImageName = `${params.registry}/${params.name}`;
    this.key = concatName(params);
  }

  public addManifestDownload(
    reference: string, callbacks: FutureCallback<IGetManifestResult>
  ): void {
    if (this.tagContext[reference]) {
      const tagContext = this.tagContext[reference];
      if (tagContext.manifestState === 1) {
        callbacks.resolve({
          mediaType: tagContext.manifestMediaType,
          manifest: tagContext.manifestString
        });
      } else if (tagContext.manifestState === 2) {
        callbacks.reject(toHttpError(tagContext.manifestFetchError));
      } else {
        this.tagContext[reference].waitingList.push(callbacks);
      }
    } else {
      const tagContext = new ImageTagContext(this, reference);
      this.tagContext[reference] = tagContext;
      tagContext.waitingList.push(callbacks);
      tagContext.downloadRootManifest()
        .then(() => tagContext.downloadSubManifests())
        .then(() => tagContext.commitManifests())
        .then(() => {
          tagContext.resolve();
          this.allBlobsDownload(tagContext)
            .finally(() => {
              tagContext.finish();
            });
        })
        .catch((err) => {
          tagContext.reject(err);
        });
    }
  }

  public addBlobDownload(digest: string, callbacks: FutureCallback<void>) {
    if (this.blobContext[digest]) {
      this.blobContext[digest].waitingList.push(callbacks);
    } else {
      const blobContext = new ImageBlobContext(this, digest);
      this.blobContext[digest] = blobContext;
      blobContext.waitingList.push(callbacks);

      this.repoClient.createBlobReadStream({
        digest
      }, (blobErr: any, stream: http.IncomingMessage) => {
        if (blobErr) {
          blobContext.reject(blobErr);
          return;
        }

        store.preparePutBlob(
          '', this.localImageName, digest
        )
          .then((putContext) => new Promise<store.PutBlobContext>((presolve, preject) => {
            let returned = false;
            const resolve = () => {
              if (returned) return;
              returned = true;
              presolve(putContext);
            };
            const reject = (e: any) => {
              if (returned) return;
              returned = true;
              preject(e);
            };

            const writeStream = putContext.createWriteStream();
            stream
              .on('error', (err) => {
                reject(err);
              })
              .pipe(writeStream)
              .on('finish', () => {
                resolve();
              })
              .on('error', (e) => reject(e));
            stream.resume();
          }))
          .then((putContext) => putContext.commit())
          .then(() => {
            blobContext.resolve();
          })
          .catch((e) => {
            blobContext.reject(e);
          });
      });
    }
  }

  allBlobsDownload(tagContext: ImageTagContext): Promise<any> {
    const promiseList: Promise<void>[] = [];
    tagContext.manifestList.forEach((manifestItem) => {
      if (manifestItem.schemaVersion === 2) {
        const manifest: IManifestSchemaVersion2 = manifestItem.data;
        if (manifest.layers) {
          manifest.layers.forEach((layer) => {
            promiseList.push(new Promise<void>((resolve) => {
              this.addBlobDownload(layer.digest, {
                resolve,
                reject: () => resolve()
              });
            }));
          });
        }
      }
    });
    return Promise.all(promiseList);
  }
}

interface GetDownloadingImageContextResult {
  first: boolean;
  imageContext: DownloadingImageInfo;
}

export class ProxyService {
  private downloadingContext: Record<string, DownloadingImageInfo> = {};

  getManifest(params: IGetManifestParams): Promise<IGetManifestResult> {
    return new Promise<IGetManifestResult>(
      (resolve, reject) => this.getDownloadingImageContext(params)
        .then((res) => res.imageContext.addManifestDownload(params.reference, {
          resolve, reject
        }))
        .catch((err) => reject(err))
    );
  }

  getBlob(params: IGetBlobParams): Promise<void> {
    return new Promise<void>((resolve, reject) => this.getDownloadingImageContext(params)
      .then((res) => {
        const { imageContext } = res;
        imageContext.addBlobDownload(params.digest, {
          resolve, reject
        });
      })
      .catch((err) => {
        reject(err);
      }));
  }

  getDownloadingImageContext(params: IBaseImageParams): Promise<GetDownloadingImageContextResult> {
    return new Promise<GetDownloadingImageContextResult>((resolve, reject) => {
      if (!params.registry) {
        reject(new CustomError(errors.TAG_INVALID));
        return;
      }

      const concatedName = concatName(params);
      if (this.downloadingContext[concatedName]) {
        resolve({
          first: false,
          imageContext: this.downloadingContext[concatedName]
        });
        return;
      }

      const imageContext = new DownloadingImageInfo(params);
      this.downloadingContext[concatedName] = imageContext;

      const repoClient: drc.RegistryClientV2 = (() => {
        const { externalRegistries } = appEnv.config;
        const registryInfo = externalRegistries && externalRegistries[imageContext.registry];
        if (registryInfo) {
          const opts: drc.CreateClientV2Options = {
            log: drcLog
          };
          if (registryInfo.endpoint) {
            opts.name = `${registryInfo.endpoint}/${imageContext.imageName}`;
          }
          if (registryInfo.username) opts.username = registryInfo.username;
          if (registryInfo.password) opts.password = registryInfo.password;
          return drc.createClientV2(opts);
        }
        return drc.createClientV2({
          log: drcLog,
          name: concatedName
        });
      })();
      imageContext.repoClient = repoClient;

      repoClient.login((err: any) => {
        if (err) {
          reject(new HttpError({
            message: err.message,
            status: 401
          }));
          return;
        }

        resolve({
          first: true,
          imageContext: this.downloadingContext[concatedName]
        });
      });
    });
  }
}

export default new ProxyService();
