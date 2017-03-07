import alt from '../alt';
import HomeActions from '../actions/HomeActions';

class HomeStore {
  constructor() {
    this.bindActions(HomeActions);
    this.sortDown = true;
  }

  onFlipOrder() {
    this.sortDown = !this.sortDown;
  }
}

export default alt.createStore(HomeStore);