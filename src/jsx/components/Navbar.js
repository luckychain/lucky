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

  handleSubmit(event) {
    event.preventDefault();

    let searchQuery = this.state.searchQuery.trim();
    
    if (searchQuery) {
      this.props.searchSubmit(searchQuery);
    }
  }

  goHome() {
    this.props.goHome();
  }

  render() {
    return (
      <div className='navbar navbar-default navbar-fixed-top'>
        <div className='navbar-header'>
          <Link to='/' onClick={this.goHome.bind(this)} className='navbar-brand'>
            Luckychain ({this.state.blockchainId})
          </Link>
        </div>
        <div id='navbar' className='navbar-collapse collapse'>
          <form ref='searchForm' className='navbar-form navbar-left animated' onSubmit={this.handleSubmit.bind(this)}>
            <div className='input-group'>
              <input type='text' className='form-control' placeholder={this.props.blocks.length + ' blocks'} value={this.state.searchQuery} onChange={NavbarActions.updateSearchQuery} />
              <span className='input-group-btn'>
                <button className='btn btn-default' onClick={this.handleSubmit.bind(this)}>
                  <span className='glyphicon glyphicon-search'></span>
                </button>
              </span>
            </div>
          </form>
          <ul className='nav navbar-nav'>
            <li onClick={this.goHome.bind(this)}><Link to='/'>Home</Link></li>
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