import React from 'react';
import Footer from './Footer';
import Navbar from './Navbar';
import AppStore from '../stores/AppStore'
import AppActions from '../actions/AppActions';
import { withRouter } from 'react-router';

class App extends React.Component {
    constructor(props) {
        super(props);
        this.state = AppStore.getState();
        this.onChange = this.onChange.bind(this);
    }

    componentDidMount() {
        AppStore.listen(this.onChange);
        AppActions.getPeers();
        AppActions.getChain();
    }

    componentWillUnmount() {
        AppStore.unlisten(this.onChange);
    }

    onChange(state) {
        this.setState(state);
    }

    setActiveKey(activeKey) {
        AppActions.setActiveKey(activeKey);
    }

    goHome() {
        console.log(this.props);
        AppActions.goHome({router:this.props.router, history:this.props.history});
    }

    searchSubmit (searchQuery) {
        AppActions.searchSubmit({searchQuery:searchQuery, router:this.props.router, history:this.props.history});
    }


    render() {


        return (
            <div>
                <Navbar history={this.props.history} blocks={this.state.blocks} searchSubmit={this.searchSubmit.bind(this)} goHome={this.goHome.bind(this)} />
                <div>{React.cloneElement(this.props.children, { blocks: this.state.blocks, treeData:this.state.treeData, setActiveKey:this.setActiveKey, activeKey:this.state.activeKey, searchSubmit:this.searchSubmit.bind(this)})}</div>
                <Footer peers={this.state.peers} />
            </div>
        );
    }
}

export default withRouter(App);