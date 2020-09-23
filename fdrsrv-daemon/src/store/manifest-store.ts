import * as errors from '@src/constants/errors';
import CustomError from '@src/http-errors/custom-error';
import appEnv from '@src/app-env';
import proxyService from '@src/services/proxy-service';
import { getLocalImageName } from '@src/v2/routes/registry-fudge';
import { dbIsolateRun } from './db';

export interface IGetManifestParams {
  registry?: string;
  name: string;
  reference: string;
}

export interface IGetManifestResult {
  mediaType: string;
  data: string;
}

export function getManifest(params: IGetManifestParams): Promise<IGetManifestResult> {
  const localImageName = getLocalImageName(params);
  return new Promise<IGetManifestResult>((resolve, reject) => {
    dbIsolateRun<any>((db) => new Promise<any>((dbRunResolve, dbRunReject) => {
      db.get(
        'SELECT * FROM `manifest` WHERE `name`=? AND `tag`=? ORDER BY `schema_version` DESC LIMIT 1', [localImageName, params.reference],
        (err, row) => {
          if (err) dbRunReject(err);
          else dbRunResolve(row);
        }
      );
    })).then((row) => {
      if (!row) {
        if (appEnv.APP_PROXY_MODE) {
          proxyService.getManifest(params)
            .then((res) => {
              resolve({
                mediaType: res.mediaType,
                data: res.manifest
              });
            })
            .catch((err) => {
              reject(err);
            });
          return;
        }

        reject(new CustomError(errors.TAG_INVALID));
        return;
      }

      resolve({
        mediaType: row.media_type,
        data: row.manifest
      });
    }).catch((err) => {
      reject(err);
    });
  });
}

export function putManifest(name: string, reference: string, data: string): Promise<void> {
  const uploadedAt = new Date();
  const manifest = JSON.parse(data);
  const { schemaVersion } = manifest;
  return dbIsolateRun((db) => new Promise((resolve, reject) => {
    db.run(
      'INSERT OR IGNORE INTO `manifest` (`name`, `tag`, `schema_version`, `uploaded_at`, `media_type`, `manifest`) VALUES (?, ?, ?, ?, ?, ?)',
      [name, reference, schemaVersion, uploadedAt.getTime(), manifest.mediaType, data],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  }));
}
