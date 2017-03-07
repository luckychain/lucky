import React from 'react';
import {Link, withRouter} from 'react-router';
import NavbarStore from '../stores/NavbarStore';
import NavbarActions from '../actions/NavbarActions';

class Navbar extends React.Component {
  constructor(props) {
    super(props);
    this.state = NavbarStore.getState();
    this.onChange = this.onChange.bind(this);
  }

  componentDidMount() {
    NavbarStore.listen(this.onChange);
    NavbarActions.getBlockchainId();
  }

  componentWillUnmount() {
    NavbarStore.unlisten(this.onChange);
  }

  onChange(state) {
    this.setState(state);
  }

  render() {
    return (
      <div className='navbar navbar-default navbar-fixed-top'>
        <div className='navbar-header'>
          <Link to='/' className='navbar-brand'>
            Luckychain ({this.state.blockchainId})
          </Link>
        </div>
        <div id='navbar' className='navbar-collapse collapse'>
          <ul className='nav navbar-nav'>
            <li><Link to='/'>Home</Link></li>
            <li><Link to='/add'>Add Transaction</Link></li>
            <li><Link to='/pending'>Pending Transactions</Link></li>
            <li><Link to='/peers'>Peers</Link></li>
          </ul>
        </div>
      </div>
    );
  }
}

export default withRouter(Navbar);