import alt from '../alt';
import {find} from 'underscore';

class NavbarActions {
    constructor() {
        this.generateActions(
            'updateOnlineUsers',
            'updateAjaxAnimation',
            'updateSearchQuery',
        );
    }
    
}

export default alt.createActions(NavbarActions);