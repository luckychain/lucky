import alt from '../alt';
import AppActions from '../actions/AppActions';

class AppStore {
  constructor() {
    this.bindActions(AppActions);
    this.sortDown = true;
    this.blocks = [];
    this.peers = [];
    this.transactions = [];
    this.blockchainId = null;
  }

  onFlipOrder() {
    this.sortDown = !this.sortDown;
  }

  onGetChainSuccess(data) {
    this.blocks = data;
  }

  onGetPeersSuccess(data) {
    this.peers = data;
  }

  onGetPendingTransactionsSuccess(data) {
    this.transactions = data;
  }

  onGetBlockchainIdSuccess(data) {
    this.blockchainId = data;
  }
}

export default alt.createStore(AppStore);