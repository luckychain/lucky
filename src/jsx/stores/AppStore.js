import alt from '../alt';
import AppActions from '../actions/AppActions';

class AppStore {
  constructor() {
    this.bindActions(AppActions);
    this.sortDown = true;
    this.blocks = [];
    this.blocksHasMore = true;
    this.blocksLimit = 100;
    this.blocksDecreasing = true;
    this.chainLength = 0;
    this.peers = [];
    this.transactions = [];
    this.blockchainId = null;
  }

  onFlipOrder() {
    this.blocksDecreasing = !this.blocksDecreasing;
    AppActions.getChain()
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
}

export default alt.createStore(AppStore);