import React from 'react';
import {Grid, Row, Col, Panel, PanelGroup, Glyphicon} from 'react-bootstrap';
import { withRouter } from 'react-router';
import HomeStore from '../stores/HomeStore';
import HomeActions from '../actions/HomeActions';

class Home extends React.Component {

    constructor(props) {
        super(props);
        this.state = HomeStore.getState();
        this.onChange = this.onChange.bind(this);
        this.props.setActiveKey(this.props.params.blockHash);
    }

    componentDidMount() {
        HomeStore.listen(this.onChange);
    }

    componentWillUnmount() {
        HomeStore.unlisten(this.onChange);
    }

    onChange(state) {
        this.setState(state);
    }

    flipOrder(event) {
        event.preventDefault();
        HomeActions.flipOrder();
    }

    handleSelect(activeKey) {
        if (activeKey === this.props.activeKey) {
            this.props.router.push('/');
            this.props.setActiveKey(null);
        } else {
            this.props.router.push('/blocks/' + activeKey);
            this.props.setActiveKey(activeKey);
        }
    }

    render() {
        var blocks = this.props.blocks;
        if (!this.state.sortDown) {
            blocks = blocks.slice().reverse();
        }
        return (
            <Grid>
                <Row>
                    <Col sm={12}>
                        <Panel header={(<span>Blockchain <Glyphicon glyph="sort" className='pull-right' style={{cursor:'pointer'}} onClick={this.flipOrder.bind(this)} />  </span>)}>
                            <PanelGroup activeKey={this.props.activeKey} onSelect={this.handleSelect.bind(this)} accordion>
                                {
                                    blocks.map((item) => {
                                        return (
                                            <Panel key={item.id} eventKey={item.hash} header={"Block " + item.id + ": " + item.hash}>
                                                <p><strong>Luck:</strong> {item.luck}</p>
                                                <p><strong>Parent:</strong> {item.parent}</p>
                                                <p><strong>Attestation:</strong> {JSON.stringify(item.attestation, null, 2)}</p>
                                                <p><strong>Transactions:</strong>
                                                    {
                                                        item.transactions.map((tx) => {
                                                            return (<span key={tx.hash}>{tx.hash}</span>);
                                                        })
                                                    }
                                                </p>

                                            </Panel>
                                        );
                                    })
                                }
                            </PanelGroup>
                        </Panel>
                    </Col>
                </Row>
            </Grid>
        );
    }
}

export default withRouter(Home);