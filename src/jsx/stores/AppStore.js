import alt from '../alt';
import AppActions from '../actions/AppActions';

class AppStore {
  constructor() {
    this.bindActions(AppActions);
    this.sortDown = true;
    this.blocks = [];
    this.blocksHasMore = true;
    this.chainLength = 0;
    this.peers = [];
    this.transactions = [];
    this.blockchainId = null;
    this.addTransactionState = '';
    this.addTransactionHelp = '';
  }

  onGetChainSuccess(data) {
    this.blocks = data.chain;
    this.blocksHasMore = data.hasMore;
  }

  onGetChainLengthSuccess(data) {
    this.chainLength = data;
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

  onAddTransactionSuccess(data) {
    this.addTransactionState = 'has-success';
    this.addTransactionHelp = data;
  }

  onAddTransactionFail(data) {
    this.addTransactionState = 'has-error';
    this.addTransactionHelp = data;
  }

  onEmptyTransaction() {
    this.addTransactionState = 'has-error';
    this.addTransactionHelp = "Please enter data or address.";
  }
}

export default alt.createStore(AppStore);