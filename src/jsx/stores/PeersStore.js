import alt from '../alt';
import PeersActions from '../actions/PeersActions';

class PeersStore {
  constructor() {
    this.bindActions(PeersActions);
    this.peers = [];
  }

  onGetPeersSuccess(data) {
    this.peers = data;
  }
}

export default alt.createStore(PeersStore);