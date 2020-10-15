# fudge-docker-registry

[![Snap Status](https://build.snapcraft.io/badge/jc-lab/fudge-docker-registry.svg)](https://build.snapcraft.io/user/jc-lab/fudge-docker-registry)

fudge-docker-registry allows you to use these images offline (private network) without modifying the deployment/statefulset image.


# Usage


## Snap Install

#### 1. install package

```bash
$ sudo snap install --edge fdrsrv
# MODIFY /var/snap/fdrsrv/current/args/daemon-env
$ sudo systemctl enable snap.fdrsrv.daemon.service
$ sudo systemctl start snap.fdrsrv.daemon.service
```

#### 2. modify containerd configuration

Under /var/snap/microk8s/current/args, there are the following parts in containerd-template.toml and containerd.toml files.
```toml
...
      [plugins.cri.registry.mirrors]
        [plugins.cri.registry.mirrors."docker.io"]
          endpoint = ["https://registry-1.docker.io"]
...
```
Change this part as shown below. (Assuming the fdrsrv server's sub domain is http://sub.fdrsrv.local:33000)
```toml
...
      [plugins.cri.registry.mirrors]
        [plugins.cri.registry.mirrors."docker.io"]
          endpoint = ["http://docker.io.sub.fdrsrv.local:33000"]
        [plugins.cri.registry.mirrors."quay.io"]
          endpoint = ["http://quay.io.sub.fdrsrv.local:33000"]
        [plugins.cri.registry.mirrors."k8s.gcr.io"]
          endpoint = ["http://k8s.gcr.io.sub.fdrsrv.local:33000"]
...
```
It must be modified on all nodes of the cluster.

Then restart the containerd service.
```bash
$ sudo systemctl restart containerd.service
# If microk8s,
$ sudo systemctl restart snap.microk8s.daemon-containerd.service
```


Also, add to /etc/hosts.
```text
10.0.0.10 fdrsrv.local
10.0.0.10 docker.io.sub.fdrsrv.local
10.0.0.10 quay.io.sub.fdrsrv.local
10.0.0.10 k8s.gcr.io.sub.fdrsrv.local
```

And then, upload the necessary images to the fudge-docker-registry server.

```bash
$ sudo ctr namespace create temp
$ sudo ctr -n temp image pull k8s.gcr.io/pause:3.1 --all-platforms
$ sudo ctr -n temp image pull docker.io/library/busybox:latest --all-platforms

$ sudo ctr -n temp image push --plain-http k8s.gcr.io.sub.fdrsrv.local:33000/pause:3.1 k8s.gcr.io/pause:3.1

$ sudo ctr -n temp image push --plain-http docker.io.sub.fdrsrv.local:33000/library/busybox:latest docker.io/library/busybox:latest
# Above is as below.
$ sudo ctr -n temp image push --plain-http fdrsrv.local:33000/docker.io/library/busybox:latest docker.io/library/busybox:latest
````

## Environment

### \* `optional` **HOST**
**Server bind hostname**

* type : hostname



### \* `required` **PORT**
**Server bind port**

* type : number
* default : 33000



### \* `optional` **APP_DATA_DIR**
**Data directory path**

* type : path
* default : ./data
* snap default : $SNAP_COMMON/data (Typically /var/snap/fdrsrv/common/data)



### \* `optional` **APP_EXEC_DIR**
**app directory**

* type : path

Used to find sqlite3.node.



### \* `optional` **APP_CONTEXT_PATH**
**Server context path**

* type : path
* default : /
* example : /registry



### \* `required` **APP_ENDPOINT**
**Server Endpoint URL**

* type : url
* example : http://fdr.example.com:33000/registry



### \* `optional` **APP_SUB_DOMAIN**
**Sub domain suffix**

* type : domain
* example : sub.fdr.example.com

If you use a fudge docker registry by sub-domain, you must set this value.

For example, when APP_SUB_DOMAIN is sub.fdr.example.com
```bash
$ docker image pull quay.io.sub.fdr.example.com/image-org/image-name:1.2.3
```
When pulling the image as above, the image will be pulled from fdr.example.com/quay.io/image-org/image-name:1.2.3



### \* `optional` **APP_JWT_SECRET**
**JWT Secret Key**

* type : string

If not you set this value, set random value.

If you use clustering (HA), you must set to same value for all nodes.



### \* `optional` **APP_ALLOW_PUBLIC_PULL**
**Allow pull without login**

* type : true/yes/1 is Allow, otherwise is Deny
* default : true



### \* `optional` **APP_NEED_LOGIN**
**Need login for image push**

* type : false/no/0 is not need, otherwise is need
* default : true



### \* `optional` **APP_PROXY_MODE**
**Enable/Disable proxy mode**

* type : false/no/0 is disable, otherwise is enable
* default : true

When an image pull is requested as a sub-domain,
if the corresponding image does not exist,
the image is retrieved from the original registry.

You can save images more easily.



### \* `optional` **APP_CONFIG_FILE**
**config javascript file path**

* type : path
* default : ./fdrsrvd.config.js
* snap default : $SNAP_COMMON/fdrsrvd.config.js (Typically /var/snap/fdrsrv/common/fdrsrvd.config.js)

format (reference to [fdrsrv-daemon/types/frdsrvd-config.d.ts](fdrsrv-daemon/types/frdsrvd-config.d.ts)):
```typescript
type LoginFunction = (username: string, password: string) => Promise<boolean> | boolean;

interface IExternalRegistryInfo {
  endpoint?: string;
  username?: string;
  password?: string;
}

interface IEnvironments {
  APP_SUB_DOMAIN: string;
  APP_CONTEXT_PATH: string;
  APP_JWT_SECRET: string;
  APP_ALLOW_PUBLIC_PULL: string;
  APP_NEED_LOGIN: string;
  APP_DATA_DIR: string;
  APP_CONFIG_FILE: string;
  APP_PROXY_MODE: string;
}

interface IFdrsrvConfig {
  overrideEnvironments?: IEnvironments;
  login?: LoginFunction;
  externalRegistries?: Record<string, IExternalRegistryInfo>;
}
```

example:
```javascript
module.exports = {
  overrideEnvironments: {
    APP_PROXY_MODE: true
  },
  // With Promise
  login: function (username, password) {
    return new Promise((resolve, reject) => {
      // resolve(true) / resolve(false)
    });
  },
  // Without Promise
  login: function (username, password) {
    // return true / return false
  },
  externalRegistries: {
    'docker.io': {
      endpoint: 'https://registry-1.docker.io',
      username: 'yourname',
      password: '12345678'
    }
  }
};
```


### \* `optional` **APP_LOGIN_USERNAME** / **APP_LOGIN_PASSWORD**
**Login username / password**

* type : string


## Export
reqdata.json
```json
{
  "imageList": [
    "ubuntu:18.04",
    "ubuntu:20.04"
  ]
}
```

```bash
curl  -o image1.tar -X POST -d "@reqdata.json" -H 'content-type: application/json; charset=utf-8' http://SERVER_ADDRESS/fdrsrv/export/multiple
```

## Import

```bash
curl -X POST -d "@image1.tar" -H 'content-type: application/octet-stream' http://SERVER_ADDRESS/fdrsrv/import/upload
```
