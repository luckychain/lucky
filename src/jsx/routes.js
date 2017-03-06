import React from 'react';
import {Route} from 'react-router';
import App from './components/App';
import Home from './components/Home';
import AddTransaction from './components/AddTransaction';
import PendingTransactions from './components/PendingTransactions';
import Peers from './components/Peers';

export default (
    <Route component={App}>
        <Route path='/' component={Home} />
        <Route path='/block/:blockHash' component={Home} />
        <Route path='/add' component={AddTransaction} />
        <Route path='/pending' component={PendingTransactions} />
        <Route path='/peers' component={Peers} />
    </Route>
);