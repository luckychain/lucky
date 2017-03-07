import alt from '../alt';
import {find} from 'underscore';
var io = require('socket.io-client');

class NavbarActions {
    constructor() {
        this.generateActions(
            'updateOnlineUsers',
            'updateSearchQuery',
            'getBlockchainIdSuccess',
            'getBlockchainIdFail',
        );
    }

    getBlockchainId() {
        this.socket = io();
        this.socket.emit('id');
        this.socket.on('idResult', (body) => {
            this.actions.getBlockchainIdSuccess(body);
        });
    }
}

export default alt.createActions(NavbarActions);