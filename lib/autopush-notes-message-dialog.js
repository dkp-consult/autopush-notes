'use babel';

const React = require('react');
const { useEffect, useCallback, useState } = React;
const { logger, useModal } = require('inkdrop');
const { Dialog } = inkdrop.components.classes;

const AutopushNotesMessageDialog = (props) => {
  const modal = useModal();
  const [status, setStatus] = useState('');

  // Mettre à jour le statut basé sur l'état de l'automatisation à chaque ouverture
  useEffect(() => {
    if (props.autoBackupEnabled) {
      setStatus('Auto backup is enabled');
    } else {
      setStatus('Auto backup is disabled');
    }
  }, [props.autoBackupEnabled]);

  const closeModal = useCallback(() => {
    modal.close();
    logger.debug('AutopushNotes modal closed.');
  }, [modal]);

  useEffect(() => {
    const sub = inkdrop.commands.add(document.body, {
      'autopush-notes:toggle': modal.show
    });
    return () => sub.dispose();
  }, [modal]);

  return (
    <Dialog {...modal.state} onBackdropClick={closeModal}>
      <Dialog.Title>Autopush Notes</Dialog.Title>
      <Dialog.Content>{status}</Dialog.Content>
      <Dialog.Actions>
        <button className="ui button" onClick={closeModal}>
          Close
        </button>
      </Dialog.Actions>
    </Dialog>
  );
}

module.exports = AutopushNotesMessageDialog;