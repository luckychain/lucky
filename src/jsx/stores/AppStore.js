import alt from '../alt';
import AppActions from '../actions/AppActions';
import {clone, map, find} from 'underscore';

class AppStore {
    constructor() {
        this.bindActions(AppActions);
        this.blocks = [];
        this.activeKey;
    }

    onSetActiveKey(activeKey) {
        this.activeKey = activeKey;
    }

    onGoHome(payload) {
        this.activeKey = "";
        payload.router.push('/');
        payload.history.push('/');
    }

    onSearchSubmit(payload) {
        var selectedBlock = find(this.blocks, function (block) {
            return block.hash == payload.searchQuery;
        })
        if (selectedBlock) {
            this.activeKey = selectedBlock.hash;
            payload.router.push('/block/' + selectedBlock.hash);
            payload.history.push('/block/' + selectedBlock.hash);
        }
    }

    onGetChainSuccess(data) {
        this.blocks = data;
    }
}

export default alt.createStore(AppStore);