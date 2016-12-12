import React from 'react';
import {Grid, Row, Col, Panel} from 'react-bootstrap';
import { withRouter } from 'react-router';
import Tree from './Tree'

class BlockExplorer extends React.Component {

    constructor(props) {
        super(props);
        this.onChange = this.onChange.bind(this);
        this.props.setActiveKey(this.props.params.blockHash);
    }

    onChange(state) {
        this.setState(state);
    }

    /*
    handleSelect(activeKey) {

        if(activeKey === this.props.activeKey) {
            this.props.router.push('/');
            this.props.setActiveKey(null);
        } else {
            this.props.router.push('/tx/' + activeKey);
            this.props.setActiveKey(activeKey);
        }
    }
    */

    render() {

        console.log(this.props);

        return (
            <Grid>
                <Row className='flipInX animated'>
                    <Col sm={12}>
                        <Panel header="Block Explorer">
                            <Tree treeData={this.props.treeData} searchSubmit={this.props.searchSubmit} />
                        </Panel>
                    </Col>
                </Row>
            </Grid>
        );
    }
}

export default withRouter(BlockExplorer);