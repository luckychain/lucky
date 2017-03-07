import alt from '../alt';
import HomeActions from '../actions/HomeActions';

class HomeStore {
  constructor() {
    this.bindActions(HomeActions);
    this.sortDown = true;
    this.activeKey;
  }

  onFlipOrder() {
    this.sortDown = !this.sortDown;
  }

  onSetActiveKey(activeKey) {
    this.activeKey = activeKey;
  }
}

export default alt.createStore(HomeStore);