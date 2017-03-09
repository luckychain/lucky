import alt from '../alt';
import io from 'socket.io-client';
import 'whatwg-fetch';

var socket = io();

class AppActions {
  constructor() {
    this.generateActions(
      'flipOrder',
      'getChainSuccess',
      'getChainFail',
      'getChainLengthSuccess',
      'getChainLengthFail',
      'getPeersSuccess',
      'getPeersFail',
      'getPendingTransactionsSuccess',
      'getPendingTransactionsFail',
      'getBlockchainIdSuccess',
      'getBlockchainIdFail',
      'addTransactionSuccess',
      'addTransactionFail',
      'emptyTransaction'
    );
  }

  getChain() {
    socket.emit('chain', {limit: this.alt.stores.AppStore.state.blocksLimit, decreasing: this.alt.stores.AppStore.state.blocksDecreasing});
  }

  getChainLength() {
    socket.emit('length');
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

  addTransaction(type, data) {
    fetch('/api/v0/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: type,
        data: data
      })
    }).then((response) => {
      if (response.status === 200) {
        return response.text();
      }
      else {
        return response.text().then((text) => {
          throw new Error(text);
        });
      }
    }).then((text) => {
      this.actions.addTransactionSuccess(text);
    }).catch((error) => {
      this.actions.addTransactionFail(`${error}`);
    });
  }
}

var actions = alt.createActions(AppActions);

socket.on('chainResult', (body) => {
  actions.getChainSuccess(body);
});

socket.on('lengthResult', (body) => {
  actions.getChainLengthSuccess(body);
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

socket.on('chainUpdated', () => {
  actions.getChainLength();
  actions.getChain();
});

export default actions;
