import alt from '../alt';
import AppActions from '../actions/AppActions';
import {clone, map, find} from 'underscore';

class AppStore {
    constructor() {
        this.bindActions(AppActions);
        this.peers = [];
        this.blocks = [];
        this.activeKey;
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
        this.peersStarData = this.createStarData([1,2,3,4,5]);
    }

    createStarData(data) {
        var starData = {
            "name": "You",
            "children": []
        }

        for (var i = 0; i < data.length; i++) {
            starData.children.push({ name: data[i], size:5000 });
        }

        return this.flatten(starData);
    }

    flatten(root) {
        var nodes = [];
        function recurse(node, depth) {
            if (node.children) {
                node.children.forEach(function(child) {
                    recurse(child, depth + 1);
                });
            }
            node.depth = depth;
            nodes.push(node);
        }
        recurse(root, 1);
        return nodes;
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
        }
    }

    onGetNewBlockSuccess(newBlock) {
        this.blocks.unshift({
            id: this.blocks.length,
            attestation: newBlock.attestation,
            hash: newBlock.hash,
            luck: newBlock.luck,
            parent: newBlock.parent,
            transactions: newBlock.transactions,
        });
    }
}

export default alt.createStore(AppStore);