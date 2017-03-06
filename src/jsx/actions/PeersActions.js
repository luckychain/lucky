import alt from '../alt';
var io = require('socket.io-client');

class PeersActions {
    constructor() {
        this.generateActions(
            'getPeersSuccess',
            'getPeersFail'
        );
    }

    getPeers() {
        this.socket = io();
        this.socket.emit('peers');
        this.socket.on('peersResult', (body) => {
            this.actions.getPeersSuccess(body);
        });
    }
}

export default alt.createActions(PeersActions);
