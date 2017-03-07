import alt from '../alt';

class HomeActions {
  constructor() {
    this.generateActions(
      'flipOrder',
      'setActiveKey'
    );
  }
}

export default alt.createActions(HomeActions);
