import React from 'react';
import {Link} from 'react-router';
import {Grid, Row, Col} from 'react-bootstrap';

class Footer extends React.Component {
    constructor(props) {
        super(props);
        this.onChange = this.onChange.bind(this);
    }

    onChange(state) {
        this.setState(state);
    }

    render() {
        let peers = this.props.peers.map((peer) => {
            return (
                <li key={peer.id}>
                    <Link to={'/peers/' + peer.id}>
                        {peer.address}
                    </Link>
                </li>
            )
        });

        return (
            <footer>
                <Grid>
                    <Row>
                        <Col sm={6}>
                            <p>Powered by <strong><a href="https://software.intel.com/en-us/sgx">Intel SGX</a></strong>, <strong><a href="https://ipfs.io/">IPFS</a></strong>, <strong><a href="https://socket.io/">Socket.io</a></strong> and <strong><a href="https://facebook.github.io/react/">React</a></strong> with <strong><a href="https://facebook.github.io/flux/">Flux</a></strong> architecture.</p>
                        </Col>
                        <Col sm={6}>
                            <p><a href="https://github.com/luckychain/lucky">Source code</a>.</p>
                        </Col>
                    </Row>
                </Grid>
            </footer>
        );
    }
}

export default Footer;