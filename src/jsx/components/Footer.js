import React from 'react';
import {Grid, Row, Col} from 'react-bootstrap';

class Footer extends React.Component {
    render() {
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