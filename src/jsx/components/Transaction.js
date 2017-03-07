import React from 'react';
import {ListGroupItem, ButtonToolbar} from 'react-bootstrap';

class Transaction extends React.Component {
  render() {
    return (
      <ListGroupItem>
        <a href={"https://gateway.ipfs.io/ipfs/" + this.props.transaction.Hash}>{this.props.transaction.Hash}</a>
        <span>{" (" + this.props.transaction.Size + " bytes)"}</span>
        <ButtonToolbar className="pull-right">
          <a href={"https://gateway.ipfs.io/api/v0/object/get/" + this.props.transaction.Hash} className="btn btn-default btn-xs">Get</a>
          <a href={"https://gateway.ipfs.io/api/v0/object/data/" + this.props.transaction.Hash} className="btn btn-default btn-xs">Data</a>
          <a href={"https://gateway.ipfs.io/api/v0/object/stat/" + this.props.transaction.Hash} className="btn btn-default btn-xs">Stat</a>
        </ButtonToolbar>
      </ListGroupItem>
    )
  }
}

export default Transaction;