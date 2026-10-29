exports.list = async (event) => {
  return { statusCode: 200, body: JSON.stringify([]) };
};

exports.get = async (event) => {
  const id = event.pathParameters.id;
  return { statusCode: 200, body: JSON.stringify({ id }) };
};

exports.create = async (event) => {
  return { statusCode: 201, body: JSON.stringify({ id: 3 }) };
};

exports.remove = async (event) => {
  return { statusCode: 204, body: '' };
};
