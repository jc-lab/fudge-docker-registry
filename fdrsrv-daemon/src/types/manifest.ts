export interface IManifestSchemaVersion1 {
  schemaVersion: 1;
  name: string;
  tag: string;
  architecture: string;
  fsLayers: {
    blobSum: string;
  }[];
  history: {
    v1Compatibility: string;
  }[];
  signatures: {
    header: any;
    signature: string;
    protected: string;
  };
}

export interface IManifestSchemaVersion2 {
  schemaVersion: 2;
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

export type IManifestAllVersions = IManifestSchemaVersion1 | IManifestSchemaVersion2;
