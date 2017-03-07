import alt from '../alt';
import io from 'socket.io-client';

var socket = io();

class AppActions {
  constructor() {
    this.generateActions(
      'flipOrder',
      'getChainSuccess',
      'getChainFail',
      'getPeersSuccess',
      'getPeersFail',
      'getPendingTransactionsSuccess',
      'getPendingTransactionsFail',
      'getBlockchainIdSuccess',
      'getBlockchainIdFail'
    );
  }

  getChain() {
    socket.emit('chain', {limit: this.alt.stores.AppStore.state.blocksLimit, decreasing: this.alt.stores.AppStore.state.blocksDecreasing});
  }

  getPeers() {
    socket.emit('peers');
  }

  getPendingTransactions() {
    socket.emit('pending');
  }

  getBlockchainId() {
    socket.emit('id');
  }
}

var actions = alt.createActions(AppActions);

socket.on('chainResult', (body) => {
  actions.getChainSuccess(body);
});

socket.on('peersResult', (body) => {
  actions.getPeersSuccess(body);
});

socket.on('pendingResult', (body) => {
  actions.getPendingTransactionsSuccess(body);
});

socket.on('idResult', (body) => {
  actions.getBlockchainIdSuccess(body);
});

export default actions;
