'use babel';

import AutopushNotesMessageDialog from './autopush-notes-message-dialog';

module.exports = {

  activate() {
    inkdrop.components.registerClass(AutopushNotesMessageDialog);
    inkdrop.layouts.addComponentToLayout(
      'modal',
      'AutopushNotesMessageDialog'
    )
  },

  deactivate() {
    inkdrop.layouts.removeComponentFromLayout(
      'modal',
      'AutopushNotesMessageDialog'
    )
    inkdrop.components.deleteClass(AutopushNotesMessageDialog);
  }

};
