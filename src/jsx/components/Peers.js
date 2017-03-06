import React from 'react';
import {Grid, Row, Col, Panel} from 'react-bootstrap';
import PeersStore from '../stores/PeersStore';
import PeersActions from '../actions/PeersActions';
import PeerGraph from './PeerGraph'

class Peers extends React.Component {
    constructor(props) {
        super(props);
        this.state = PeersStore.getState();
        this.onChange = this.onChange.bind(this);
    }

    componentDidMount() {
        PeersStore.listen(this.onChange);
        PeersActions.getPeers();
    }

    componentWillUnmount() {
        PeersStore.unlisten(this.onChange);
    }

    onChange(state) {
        this.setState(state);
    }

    render() {
        return (
            <Grid>
                <Row>
                    <Col sm={12}>
                        <Panel header="Block Explorer">
                            <PeerGraph peersStarGraph={this.state.peers}/>
                        </Panel>
                    </Col>
                </Row>
                <Row>
                    <Col sm={12}>
                        <Panel header={(<span>Peers</span>)}>
                            {
                                this.state.peers.map((item) => {
                                    return (
                                        <p key={item.id}>{"Peer " + item.id}</p>
                                    );
                                })
                            }
                        </Panel>
                    </Col>
                </Row>
            </Grid>
        );
    }
}

export default Peers;