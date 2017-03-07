import alt from '../alt';
import PendingTransactionsActions from '../actions/PendingTransactionsActions';

class PendingTransactionsStore {
  constructor() {
    this.bindActions(PendingTransactionsActions);
    this.transactions = [];
  }

  onGetPendingTransactionsSuccess(data) {
    this.transactions = data;
  }
}

export default alt.createStore(PendingTransactionsStore);