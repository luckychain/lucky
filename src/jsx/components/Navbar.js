import React from 'react';
import {Link, withRouter} from 'react-router';

class Navbar extends React.Component {
  render() {
    return (
      <div className='navbar navbar-default navbar-fixed-top'>
        <div className='navbar-header'>
          <Link to='/' className='navbar-brand'>
            Luckychain ({this.props.blockchainId})
          </Link>
        </div>
        <div id='navbar' className='navbar-collapse collapse'>
          <ul className='nav navbar-nav'>
            <li><Link to='/'>Home</Link></li>
            <li><Link to='/add'>Add Transaction</Link></li>
            <li><Link to='/pending'>Pending Transactions<span className='badge badge-up badge-danger'>{this.props.transactions.length}</span></Link></li>
            <li><Link to='/peers'>Peers<span className='badge badge-up badge-info'>{this.props.peers.length}</span></Link></li>
          </ul>
        </div>
      </div>
    );
  }
}

export default withRouter(Navbar);