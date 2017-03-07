import React from 'react';
import Footer from './Footer';
import Navbar from './Navbar';
import AppStore from '../stores/AppStore'
import AppActions from '../actions/AppActions';
import {withRouter} from 'react-router';

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = AppStore.getState();
    this.onChange = this.onChange.bind(this);
  }

  componentDidMount() {
    AppStore.listen(this.onChange);
    AppActions.getBlockchainId();
    AppActions.getChain();
    AppActions.getPeers();
    AppActions.getPendingTransactions();
  }

  componentWillUnmount() {
    AppStore.unlisten(this.onChange);
  }

  onChange(state) {
    this.setState(state);
  }

  render() {
    return (
      <div>
        <Navbar blockchainId={this.state.blockchainId} transactions={this.state.transactions} peers={this.state.peers} />
        <div className="content">{React.cloneElement(this.props.children, {blocks: this.state.blocks, peers: this.state.peers, transactions: this.state.transactions, sortDown: this.state.sortDown})}</div>
        <Footer/>
      </div>
    );
  }
}

export default withRouter(App);
