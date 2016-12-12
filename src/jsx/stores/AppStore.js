import alt from '../alt';
import AppActions from '../actions/AppActions';
import {clone, map, find} from 'underscore';

class AppStore {
    constructor() {
        this.bindActions(AppActions);
        this.peers = [];
        this.blocks = [];
        this.treeData;
        this.activeKey;
    }

    formatTreeData(data) {

        data = map(data, function(item){
            var i = clone(item);
            i.parentHash = i.parent;
            return i;
        });

        console.log(data);

        // create a name: node map
        var dataMap = data.reduce(function(map, node) {
            map[node.hash] = node;
            return map;
        }, {});

        console.log(dataMap);

        // create the tree array
        var treeData = [];
        data.forEach(function(node) {
            // add to parent
            var parent = dataMap[node.parent];
            if (parent === "GENESIS") {
                parent = null;
            }
            if (parent) {
                // create child array if it doesn't exist
                (parent.children || (parent.children = []))
                // add node to child array
                    .push(node);
            } else {
                // parent is  or missing
                treeData.push(node);
            }
        });

        console.log(treeData);

        return treeData;
    }

    onSetActiveKey(activeKey) {
        this.activeKey = activeKey;
    }

    onGoHome(payload) {
        this.activeKey = "";
        payload.router.push('/');
        payload.history.push('/');
    }

    onSearchSubmit(payload) {
        var selectedBlock = find(this.blocks, function(block){ return block.hash == payload.searchQuery; })
        if (selectedBlock) {
            this.activeKey = selectedBlock.hash;
            payload.router.push('/blocks/' + selectedBlock.hash);
            payload.history.push('/blocks/' + selectedBlock.hash);
        }

    }


    onGetPeersSuccess(data) {
        /*if (data) {

            var peers = [];
            for (var i = 0; i < data.peers.length; i++) {
                peers.push({ id: i, address: data.peers[i] });
            }

            this.peers = peers;
        }*/
        this.peers = data;
    }

    onGetChainSuccess(data) {
        if (data) {
            /*
            var chain = data.chain;

            var blocks = [];
            for (var i = 0; i < chain.length; i++) {
                var block = chain[i];
                blocks.push({
                    id: i,
                    attestation: block.attestation,
                    hash: block.hash,
                    luck: block.luck,
                    parent: block.parent,
                    transactions: block.transactions,
                });
            }
            */
            this.blocks = data;
            console.log(this.blocks);
            //this.treeData = blocks;
            this.treeData = this.formatTreeData(data);
        }
    }
}

export default alt.createStore(AppStore);