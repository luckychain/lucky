import alt from '../alt';
import NavbarActions from '../actions/NavbarActions';

class NavbarStore {
    constructor() {
        this.bindActions(NavbarActions);
        this.totalTransactions = 0;
        this.onlineUsers = 0;
        this.searchQuery = '';
        this.blockchainId = null;
    }

    onUpdateOnlineUsers(data) {
        this.onlineUsers = data.onlineUsers;
    }

    onUpdateSearchQuery(event) {
        this.searchQuery = event.target.value;
    }

    onGetBlockchainIdSuccess(data) {
        this.blockchainId = data;
    }
}

export default alt.createStore(NavbarStore);