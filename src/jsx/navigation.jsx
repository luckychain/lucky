var React = require('react');

var Navbar = require('react-bootstrap/lib/Navbar');

var Navigation = React.createClass({
  render: function () {
    return (
      <Navbar inverse>
        <Navbar.Header>
          <Navbar.Brand>
            <a href="#">luckychain</a>
          </Navbar.Brand>
          <Navbar.Toggle />
        </Navbar.Header>
      </Navbar>
    );
  }
});

module.exports = Navigation;