import alt from '../alt';
var io = require('socket.io-client');

class AppActions {
    constructor() {
        this.generateActions(
            'initializeLocalState',
            'getPeersSuccess',
            'getPeersFail',
            'getChainSuccess',
            'getChainFail',
            'goHome',
            'searchSubmit',
            'setActiveKey',
        );
    }

    getChain() {
        var that = this;
        this.socket = io();
        this.socket.emit('chain');
        this.socket.on('chainResult', function (body) {
            var chain = body;

            var blocks = [];
            for (var i = 0; i < chain.length; i++) {
                var block = chain[i];
                blocks.unshift({
                    id: i,
                    attestation: block.attestation,
                    hash: block.hash,
                    luck: block.luck,
                    parent: block.parent,
                    transactions: block.transactions,
                });
            }

            that.actions.getChainSuccess(blocks);
        });
    }

    getPeers() {
        var that = this;
        this.socket = io();
        this.socket.emit('peers');
        this.socket.on('peersResult', function (body) {
            var peers = [];
            for (var i = 0; i < body.length; i++) {
                peers.push({ id: i, address: body[i] });
            }
            that.actions.getPeersSuccess(peers);
        });
    }

}

export default alt.createActions(AppActions);
