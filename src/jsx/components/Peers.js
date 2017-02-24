import React from 'react';
import {Grid, Row, Col, Panel} from 'react-bootstrap';
import { withRouter } from 'react-router';
import PeerGraph from './PeerGraph'

class Peers extends React.Component {


    constructor(props) {
        super(props);
        this.onChange = this.onChange.bind(this);
    }

    onChange(state) {
        this.setState(state);
    }

    render() {

        console.log(this.props);

        return (
            <Grid>
                <Row className='flipInX animated'>
                    <Col sm={12}>
                        <Panel header="Block Explorer">
                            <PeerGraph peersStarGraph={this.props.peersStarData} searchSubmit={this.props.searchSubmit} />
                        </Panel>
                    </Col>
                </Row>
            </Grid>
        );
    }
}

export default withRouter(Peers);
