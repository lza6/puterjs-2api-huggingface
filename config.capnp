# config.capnp (最终兼容版)
@0xbfd9b5b79af23c35;
using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [ (name = "main", worker = .myWorker) ],
  sockets = [
    (name = "http", address = "*:8080", http = (), service = "main")
  ]
);
const myWorker :Workerd.Worker = (
  modules = [ (name = "worker.js", esModule = embed "worker.js") ],
  compatibilityDate = "2024-01-01"
  # 'cache = true' has been removed to be compatible with workerd v1.20240222.0
);
