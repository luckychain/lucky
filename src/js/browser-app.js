var React = require('react');
var ReactDOM = require('react-dom');
var Layout = require('../jsx/layout.jsx');

ReactDOM.render(<Layout title="lucky" pathname={window.location.pathname} />, document.body);