import alt from '../alt';
import AppActions from '../actions/AppActions';
import {clone, map, find} from 'underscore';

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