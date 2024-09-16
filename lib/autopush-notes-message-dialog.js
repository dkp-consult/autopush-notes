'use babel';

const React = require('react');
const { useEffect, useCallback, useState } = React;
const { logger, useModal } = require('inkdrop');

const AutopushNotesMessageDialog = (props) => {
  const modal = useModal();
  const [status, setStatus] = useState('AutopushNotes was toggled!');
  const { Dialog } = inkdrop.components.classes;

  const toggle = useCallback(() => {
    modal.show();
    setStatus('Sauvegarde en cours...');
    logger.debug('AutopushNotes sauvegarde des notes!');
  }, []);

  useEffect(() => {
    const sub = inkdrop.commands.add(document.body, {
      'autopush-notes:toggle': toggle
    });
    return () => sub.dispose();
  }, [toggle]);

  return (
    <Dialog {...modal.state} onBackdropClick={modal.close}>
      <Dialog.Title>AutopushNotes</Dialog.Title>
      <Dialog.Content>{status}</Dialog.Content>
      <Dialog.Actions>
        <button className="ui button" onClick={modal.close}>
          Close
        </button>
      </Dialog.Actions>
    </Dialog>
  );
}

module.exports = AutopushNotesMessageDialog;
