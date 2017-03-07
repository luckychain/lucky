import alt from '../alt';
import AppActions from '../actions/AppActions';

class AppStore {
  constructor() {
    this.bindActions(AppActions);
    this.blocks = [];
  }

  onGetChainSuccess(data) {
    this.blocks = data;
  }
}

export default alt.createStore(AppStore);