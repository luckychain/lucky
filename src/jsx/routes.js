import React from 'react';
import {Route} from 'react-router';
import App from './components/App';
import Home from './components/Home';
import BlockExplorer from './components/BlockExplorer'
import AddTransaction from './components/AddTransaction';

export default (
    <Route component={App}>
        <Route path='/' component={Home} />
        <Route path='/blocks/:blockHash' component={Home} />
        <Route path='/add' component={AddTransaction} />
        <Route path='/tree' component={BlockExplorer} />
    </Route>
);