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
        console.log("hi");
        this.props.goHome();
    }

    render() {
        return (
            <div className='navbar navbar-default navbar-fixed-top'>
                <div className='navbar-header'>
                    <button type='button' className='navbar-toggle collapsed' data-toggle='collapse' data-target='#navbar'>
                        <span className='sr-only'>Toggle navigation</span>
                        <span className='icon-bar'></span>
                        <span className='icon-bar'></span>
                        <span className='icon-bar'></span>
                    </button>
                    <Link to='/' onClick={this.goHome.bind(this)} className='navbar-brand'>
            <span ref='triangles' className={'triangles animated ' + this.state.ajaxAnimationClass}>
              <div className='tri invert'></div>
              <div className='tri invert'></div>
              <div className='tri'></div>
              <div className='tri invert'></div>
              <div className='tri invert'></div>
              <div className='tri'></div>
              <div className='tri invert'></div>
              <div className='tri'></div>
              <div className='tri invert'></div>
            </span>
                        Luckychain
                        
                        <span className='badge badge-up badge-danger'>{this.state.onlineUsers}</span>
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
                        <li><Link to='/tree'>Tree</Link></li>
                        <li><Link to='/add'>Add</Link></li>
                    </ul>
                </div>
            </div>
        );
    }
}

export default withRouter(Navbar);