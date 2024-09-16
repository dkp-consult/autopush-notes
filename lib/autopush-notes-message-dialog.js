'use babel';

const React = require('react');
const { useEffect, useCallback, useState } = React;
const { logger, useModal } = require('inkdrop');

const AutopushNotesMessageDialog = (props) => {
  const modal = useModal();  // Utiliser useModal pour gérer l'état d'affichage
  const [status, setStatus] = useState('En attente de sauvegarde...');
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const { Dialog } = inkdrop.components.classes;

  // Fonction pour ouvrir la modal
  const toggle = useCallback(() => {
    modal.show();
    setStatus('Prêt à lancer une sauvegarde manuelle ou gérer la sauvegarde automatique.');
    logger.debug('AutopushNotes modal ouverte!');
  }, [modal]);

  // Sauvegarde manuelle
  const handleManualBackup = useCallback(() => {
    setStatus('Sauvegarde manuelle en cours...');
    logger.debug('Sauvegarde manuelle déclenchée.');

    // Déclencher la commande de sauvegarde manuelle
    inkdrop.commands.dispatch(document.body, 'autopush-notes:startBackup');
  }, []);

  // Activer/Désactiver la sauvegarde automatique
  const handleToggleAutoBackup = useCallback(() => {
    if (autoBackupEnabled) {
      inkdrop.commands.dispatch(document.body, 'autopush-notes:disableAutoBackup');
      setStatus('Sauvegarde automatique désactivée.');
      logger.debug('Sauvegarde automatique désactivée.');
    } else {
      inkdrop.commands.dispatch(document.body, 'autopush-notes:enableAutoBackup');
      setStatus('Sauvegarde automatique activée.');
      logger.debug('Sauvegarde automatique activée.');
    }
    setAutoBackupEnabled(!autoBackupEnabled);
  }, [autoBackupEnabled]);

  // Commande pour afficher la modal
  useEffect(() => {
    const sub = inkdrop.commands.add(document.body, {
      'autopush-notes:openModal': toggle
    });
    return () => sub.dispose();
  }, [toggle]);

  return (
    <Dialog {...modal.state} onBackdropClick={modal.close}>
      <Dialog.Title>AutopushNotes - Gérer les sauvegardes</Dialog.Title>
      <Dialog.Content>
        <p>{status}</p>
      </Dialog.Content>
      <Dialog.Actions>
        <button className="ui button" onClick={handleManualBackup}>
          Lancer une sauvegarde manuelle
        </button>
        <button className="ui button" onClick={handleToggleAutoBackup}>
          {autoBackupEnabled ? 'Désactiver la sauvegarde automatique' : 'Activer la sauvegarde automatique'}
        </button>
        <button className="ui button" onClick={modal.close}>
          Fermer
        </button>
      </Dialog.Actions>
    </Dialog>
  );
};

module.exports = AutopushNotesMessageDialog;