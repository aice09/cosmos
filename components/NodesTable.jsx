'use client';

import { useEffect, useRef, useState } from 'react';

export default function NodesTable({ nodes }) {
  const tableRef = useRef(null);
  const [tableError, setTableError] = useState('');

  useEffect(() => {
    let active = true;
    let table;

    import('datatables.net-bs5')
      .then(({ default: DataTable }) => {
        if (!active || !tableRef.current) return;
        table = new DataTable(tableRef.current, {
          pageLength: 5,
          lengthChange: false,
          order: [[0, 'asc']],
          language: {
            search: '',
            searchPlaceholder: 'Search nodes...',
            emptyTable: 'No nodes found',
          },
        });
      })
      .catch((error) => {
        console.error('Unable to initialize the node table:', error);
        if (active) setTableError('The searchable node table could not be initialized.');
      });

    return () => {
      active = false;
      table?.destroy();
    };
  }, []);

  return (
    <>
      {tableError && <p className="small text-danger mb-3">{tableError}</p>}
      <div className="table-responsive">
        <table ref={tableRef} className="table align-middle node-table w-100">
          <thead>
            <tr>
              <th>Node</th>
              <th>Status</th>
              <th>Role</th>
              <th>Kubernetes</th>
              <th>CPU</th>
              <th>Memory</th>
              <th>Pods</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.name}>
                <td>
                  <span className="node-name">
                    <i className="fa-solid fa-server me-2" aria-hidden="true" />
                    {node.name}
                  </span>
                </td>
                <td>
                  <span className={`status-pill ${node.status === 'Ready' ? 'healthy' : 'unhealthy'}`}>
                    <span className="status-dot" />
                    {node.status}
                  </span>
                </td>
                <td className="text-secondary">{node.roles.join(', ')}</td>
                <td className="text-secondary">{node.version}</td>
                <td>{node.cpu}</td>
                <td>{node.memory}</td>
                <td>{node.pods}</td>
                <td className="text-secondary">{node.age}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
