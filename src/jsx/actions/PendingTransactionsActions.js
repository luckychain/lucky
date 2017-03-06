import alt from '../alt';
var io = require('socket.io-client');

class PendingTransactionsActions {
    constructor() {
        this.generateActions(
            'getPendingTransactionsSuccess',
            'getPendingTransactionsFail'
        );
    }

    getPendingTransactions() {
        this.socket = io();
        this.socket.emit('pending');
        this.socket.on('pendingResult', (body) => {
            this.actions.getPendingTransactionsSuccess(body);
        });
    }
}

export default alt.createActions(PendingTransactionsActions);
