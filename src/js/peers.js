module.exports = function(ipfs, logger, IPFS_ID, DIRECTORY, ID_DIRECTORY) { 

  /* Returns the hash identifier for this blockchain application */
  this.ipfsPeerID = function() {
    logger("ipfsPeerID");
    return new Promise((resolve) => {
      ipfs.add(ID_DIRECTORY, (err, res) => {
        if (err) logger("error: ipfsPeerID failed", err);
        else {
          var hash = res[0].Hash;
          logger("ipfsPeerID: " + hash);
          resolve(hash);
        }
      });
    });
  };

  /* Returns the peers who are a part of this blockchain application */
  this.ipfsPeerDiscovery = function(hash) {
    logger("ipfsPeerDiscovery");
    return new Promise((resolve) => {
      oboe("http://127.0.0.1:5001/api/v0/dht/findprovs\?arg\=" + hash).done((res) => {
        if (res.Type === 4) {
          var id = res.Responses[0].ID;
          if (id !== IPFS_ID) {
            ipfsPubSub(id);
            logger("ipfsPeerDiscovery: " + id);
          }
        }
      }).fail(function() {
        console.log("error: ipfsPeerDiscovery failed to find peers");
      });
    });
  };

  this.ipfsPubSub = function(peerID) {
    logger("ipfsPubSub");
    ipfsPeerResolve(peerID).then((path) => { return ipfsGetData(path, "/pubsub"); }).then((p2pID) => {
      var id = PeerId.createFromJSON(p2pID);
      var peer = new PeerInfo(id);
      peer.multiaddr.add(multiaddr('/ip4/0.0.0.0/tcp/10333'));
      pubSub.connect(peerPublisher);
    });
  };

  /* Publish the files under DIRECTORY using IPNS */
  this.ipfsPeerPublish = function() {
    logger("ipfsPeerPublish");
    return new Promise((resolve) => {
      ipfs.add(DIRECTORY, { recursive: true }, (err, addRes) => {
        if (err) logger("error: ipfsPeerPublish failed", err);
        else {
          var hash = addRes.filter((path) => { return path.Name === DIRECTORY; })[0].Hash;
          ipfs.name.publish(hash, null, (err, publishRes) => {
            if (err) logger("ipfsPeerPublish error: ipfs.name.publish failed", err);
            else {
              var name = publishRes.Name;
              logger("ipfsPeerPublish successful: " + name);
              resolve(name);
            }
          });
        }
      });
    });
  };

  /* Returns the resolved path given a peer id - called every pubsub interval */
  this.ipfsPeerResolve = function(id) {
    logger("ipfsPeerResolve");
    return new Promise((resolve) => {
      ipfs.name.resolve(id, null, (err, nameRes) => {
        if (err) {
          peers = _.without(peers, id);
          logger("ipfsPeerResolve error: ipfs.name.resolve failed for " + id, err);
        } else resolve(nameRes.Path);
      });
    });
  };

  /* Returns the requested data given a resolved IPFS path and link */
  this.ipfsGetData = function(path, link) {
    logger("ipfsGetData");
    return new Promise((resolve) => {
      ipfs.cat(path + link, (err, catRes) => {
        if (err) logger("ipfsGetData error: ipfs.cat failed", err);
        else {
          var chunks = [];
          catRes.on("data", (chunk) => { chunks.push(chunk); });
          catRes.on("end", () => {
            if (chunks.length > 0) {
              var data = chunks.join("");
              if (validObject(data)) {
                if (typeof data === "string") data = JSON.parse(data);
                resolve(data);
              }
            }
          })
        }
      })
    })
  };
}