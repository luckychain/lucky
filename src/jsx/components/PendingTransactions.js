import React from 'react';
import {Grid, Row, Col, Panel} from 'react-bootstrap';
import PendingTransactionsStore from '../stores/PendingTransactionsStore';
import PendingTransactionsActions from '../actions/PendingTransactionsActions';

class PendingTransactions extends React.Component {
    constructor(props) {
        super(props);
        this.state = PendingTransactionsStore.getState();
        this.onChange = this.onChange.bind(this);
    }

    componentDidMount() {
        PendingTransactionsStore.listen(this.onChange);
        PendingTransactionsActions.getPendingTransactions()
    }

    componentWillUnmount() {
        PendingTransactionsStore.unlisten(this.onChange);
    }

    onChange(state) {
        this.setState(state);
    }

    render() {
        return (
            <Grid>
                <Row>
                    <Col sm={12}>
                        <Panel header={(<span>Pending Transactions</span>)}>
                            {
                                this.state.transactions.map((item) => {
                                    return (
                                        <p key={item.Hash}>{"Transaction " + item.Hash + " (" + item.Size + " B)"}</p>
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

export default PendingTransactions;